# 15 - Field Sales and Distribution System Engineering Plan

**Status:** Planning directive; not implementation evidence or phase acceptance
**Business:** Kiran Company
**Operating market:** Karachi, Pakistan
**Authority:** Read with AGENTS.md, CLAUDE.md, docs/ACTIVITY.md, SPEC.md and docs 00-14. `docs/16-project-completion-goal.md` is the authoritative business specification and wins over this plan (D-33); this plan is amended to match it (D-34 to D-41; approved, not built). The existing authority hierarchy, D-08 governance split as amended by D-39, H-01 through H-27, approval controls, append-only rules, phase gates and human-only actions remain in force.

## 1. Mission and outcome

Build one reliable system through which Kiran Company manages its direct salon distribution operation across Karachi.

The system connects:
1. A complete salon/customer database, including salons that are not listed on Google Maps.
2. A field sales team that visits salons, records GPS-verified activity, manages routes and submits order requests.
3. A secure salon customer portal through which a salon can submit order requests and track its own orders.
4. One product catalogue shared by all salons, with each salon seeing its own approved selling prices.
5. Authoritative inventory, stock availability, order processing, delivery, invoicing, collections and receivables.
6. An office workspace for the owner and manager to control the operation and investigate exceptions.
7. Reporting that distinguishes physical visits, submitted orders, fulfilment, cash collection, outstanding balances and representative contribution.

The system must answer from recorded evidence: which salons are served and where they are; which representative acquired and currently manages each salon; where active representatives are; which visits happened and their outcomes; which orders came from a rep versus a salon; what was ordered and at which price; what has been delivered, invoiced, paid or remains outstanding; and what stock is on hand and available to promise.

## 2. Confirmed operating rules

### 2.1 Direct-supply customer model

Kiran Company supplies its own products to direct salon customers. The canonical customer record is the salon in Kiran's database. Google Maps is an optional discovery/navigation provider, not the customer database.

A salon must be registrable with a name, contact details, address, area/landmark and manually selected GPS coordinates even when it has no Google Maps listing or provider place ID.

### 2.2 Two order channels, one order system

Only the office (owner or manager) creates official orders. Representatives and salon customers submit order requests (D-30, D-34, ACTIVITY L-0363).

- **Office channel:** the manager or owner creates the order in the Orders area, often from a representative's order-intake card: the rep agrees the salon's requirements on the rep's screen and saves a "New Order Details" card; the manager converts it into an order and the card is closed and linked to it.
- **Salon portal channel:** an authenticated salon user signs into the portal, views the shared catalogue and that salon's assigned prices, builds an order request and submits it for that salon.

Both requests go to one Requests queue. When the office converts one, it creates the same canonical sales-order aggregate, under the same server-side SKU, price, stock, credit, duplicate-submission and order-state rules. The channel is `office` for direct orders and rep requests and `salon_portal` for salon requests; `rep_visit` stays for legacy rows only. Do not create separate order ledgers or separate inventory calculations.

The channel and actor are recorded explicitly. A salon portal order is not a representative visit and must not be credited as a physical visit, visit conversion or rep-taken order.

A salon's request waits for the manager's approval; nothing is reserved or delivered before confirmation (OQ-31 answered, D-30, D-34). Until the manager decides it, the submitter may edit (a new version) or cancel its own request; afterwards it may not, so the decision is the cutoff (ACTIVITY L-0378).

### 2.3 Catalogue, salon pricing and stock visibility

- All salons see the same active company product catalogue, subject to product sellability/availability.
- Each salon sees only the price assigned to that salon.
- SKU and per-salon prices are set by the owner or manager with a reason (D-37, D-39). Dated price lists remain owner-governed under D-08. Do not grant a generic admin role or promote Manager permissions further.
- Authorised business-facing users may see product stock quantities (for salons this stays Phase 2, INV-12, D-41), but only safe aggregate quantities. Do not reveal supplier identity, purchase price, margin, internal stock location, rep-bag custody or restricted operational notes.
- Inventory remains an append-only movement ledger. No user edits a stock balance directly. Office stock adjustments use the existing authorized movement/approval workflow.
- Distinguish **on-hand** from **available-to-order**. On-hand is the sum of sellable stock across permitted locations. Available-to-order is on-hand less reservations/committed quantities and other explicitly unavailable quantities. Quarantine, damaged, expired and otherwise non-sellable units are excluded. Do not label one measure as the other.

### 2.4 Representative and salon attribution

Never collapse these separate concepts into one mutable representative field:

1. **Acquisition representative:** who originally registered/acquired the salon; historical attribution is immutable.
2. **Current assigned representative:** who currently owns day-to-day coverage; reassignment is effective-dated and auditable.
3. **Order-taking representative:** on legacy `rep_visit` orders only, the rep who took the order during a visit. Since D-30 no rep takes an order; a rep's request records its rep on the card.
4. **Order creator:** the authenticated person who submitted the order.
5. **Order channel:** `office` (direct orders and rep requests), `salon_portal` (salon requests), `rep_visit` (legacy rows only).

A later reassignment must not rewrite acquisition history or historical order attribution. A salon's request must not fabricate a visit, rep-day, GPS event or representative.

### 2.5 Existing governance and adjacent business channels

Preserve D-08: Owner and Manager have documented operational permissions; governance powers such as price-list management, user/role management, bank details, write-offs/credit notes, commission plans, vault grants, audit log and system configuration remain owner-only as documented (commission rates: owner or manager, D-31, MJ L-0385; inviting and managing reps and salons, products and prices: owner or manager, D-39). "Admin area" means the existing permission-governed office workspace, not a new unrestricted admin role.

Preserve independent-agent D-15 and investor/capital-partner D-24 as separate domains. Salon customer, employee, agent, investor and supplier are not interchangeable identities.

Commission follows D-31 and D-38. Do not implement or infer payroll, bonus or deduction formulas while OQ-09 stays open for them.

## 3. Product surfaces and actor workspaces

The system exposes three coordinated workspaces over one backend.

### 3.1 Representative workspace - /app

Mobile-first installable PWA for field use.

Primary capabilities:
- Daily check-in/check-out and rep-day status.
- Assigned salons, territories, routes and visit due list.
- Map with known salon pins, manually created prospect pins and the rep's own position.
- Visit arrival/check-in, GPS/time capture, outcome, notes and optional evidence photo.
- Salon profile, read-only (D-35), and visit/order history limited to the rep's authorized scope; salon notes.
- New Order Details card, an order request with optional lines, for the salon (reps do not create orders, D-30, D-34).
- Propose a new salon, which stays pending (D-35).
- Own commission and payment history, read-only (D-38).
- Order status, delivery task, collections, receipts, bag stock, handover and day close according to approved scope.
- Offline support for approved rep workflows, with idempotent sync and explicit conflict handling.
- No access to supplier/cost data or other representatives' private GPS trail.

### 3.2 Salon customer workspace - /salon

Authenticated customer-facing portal, separate from internal employee roles.

Primary capabilities:
- Secure invitation, account activation, sign-in, recovery and session revocation.
- View the shared active product catalogue.
- View the salon's own assigned selling prices.
- Safe aggregate stock quantities and availability: stays Phase 2 (INV-12, D-41).
- Create and submit order requests for that salon.
- View only that salon's requests, orders, statuses, order lines and permitted history.
- View its invoices, receipts, payment records, outstanding statement and delivery information when those records exist and are customer-authorized.
- Receive order acknowledgements and status notifications through configured channels.
- Request profile/contact corrections without directly editing protected customer master fields.

The salon portal is online-first for request submission. If connectivity fails before server acknowledgement, the UI must clearly show that submission did not complete or is pending; it must never display false success. Retry uses an idempotency key so one retry cannot create duplicate requests. Offline salon requests are not in this work (spec section 8).

### 3.3 Office workspace - /office

Owner and Manager use a shared office application with permission-specific actions.

Primary capabilities:
- Salon master, deduplication, location correction, customer onboarding and assignment.
- Representative roster, territories, route oversight, daily attendance and location map.
- Product/SKU catalogue management with pictures and descriptions, and SKU and per-salon prices, by the owner or manager (D-37, D-39).
- Owner-governed dated price-list management.
- Commission rates and payments; the investor ledger, separate from commission (D-38, D-40).
- Inventory movements, stock counts, reservations and availability oversight.
- One Requests queue for rep and salon order requests, in the Orders area (D-34).
- Confirm/reject/hold/release actions according to approved workflow and role.
- Dispatch, delivery, invoice, return, payment, reconciliation and receivables.
- Exception review, audit trail and management reporting.
- Secure rep and salon account invitations, suspension and account-to-salon membership management by the owner or manager (D-30, D-39): invitation-only, one salon per login (ACTIVITY L-0376).

## 4. Module map

The modules define the target product boundary. They do not claim that corresponding code already exists or is complete.

| Module | System | Main responsibility | Primary users |
|---|---|---|---|
| M01 | Identity, sessions and authorization | Secure identities, role separation, salon membership and RLS | All actors |
| M02 | Salon CRM and customer master | Salon registration, profiles, contacts, dedupe and lifecycle | Office, reps |
| M03 | Geographic data and mapping | Coordinates, map pins, provider lookup and area/territory coverage | Office, reps |
| M04 | Field force and visit execution | Rep days, routes, GPS visits, outcomes and active-day location | Office, reps |
| M05 | Product catalogue and price engine | SKU catalogue, salon-specific price lookup and price snapshots | Office, reps, salons |
| M06 | Inventory and availability | Stock ledger, internal custody and public aggregate availability | Office, reps, salons |
| M07 | Unified order management | Rep and salon order requests; office order creation, validation, approval and state | Office, reps, salons |
| M08 | Fulfilment, delivery and documents | Dispatch, delivery, invoice, receipt, returns and credit notes | Office, reps, salons |
| M09 | Payments, credit and receivables | Collections, allocations, installment schedule, balance and reconciliation | Office, reps, salons |
| M10 | Notifications and customer communication | Order/status updates, receipts and opt-in reminders | Office, reps, salons |
| M11 | Analytics and operational reporting | Coverage, rep productivity, orders, fulfilment, product demand and cash | Office |
| M12 | Office administration, approvals and audit | Controlled settings, approvals, exception monitoring and evidence | Owner, Manager by permission |

### M01 - Identity, sessions and authorization

**Engineer**
- Preserve existing Supabase Auth and staff user_profile model.
- Keep staff roles (owner, manager, rep) distinct from customer membership.
- Add a salon account membership model mapping an authenticated auth user to one or more explicitly authorized salon IDs. Default to one salon per login unless MJ approves multi-salon access.
- Support invite, accept/verify, activate, suspend, revoke and offboard flows.
- Derive salon identity only from the authenticated membership on the server/database. Never accept a client-supplied salon_id as proof of authority.
- Define session and recovery controls appropriate for customer accounts without weakening staff MFA/device controls.
- A suspended membership must immediately lose protected read/write access.

**Acceptance**
- A salon user can access its own salon only.
- Changing route parameters, request bodies, IDs or browser state cannot reveal another salon.
- A salon account cannot call staff, owner, manager, agent or investor functions.
- Revocation removes portal access without deleting business history.

### M02 - Salon CRM and customer master

**Engineer**
- Maintain one canonical salon record with internal ID, customer name, category/type, address, Karachi area, landmarks, contact records, notes, lifecycle/stage, origin/source, acquisition metadata, current assignment and optional map provider IDs.
- Support manual location capture: typed address, dropped pin, coordinate entry, customer-shared location or map search result.
- Provider place ID and metadata remain optional. Do not reject a salon with no external listing.
- Build deduplication using normalized name/contact/address and proximity, with human review for uncertain matches.
- Keep contact records separate from login credentials. A contact phone is not automatically a portal login.
- Add effective-dated representative assignment history; preserve original acquisition rep. A direct assignment limits the salon to that rep; otherwise territory coverage applies (D-36).
- A rep's new salon is a pending proposal until the office approves it; reps cannot edit an existing salon (D-35).
- Provide an approved salon account invitation action linked to the exact salon.
- Keep append-only visit, note, stage and audit history consistent with existing rules.

**Acceptance**
- A salon not on Google Maps can be created, pinned, assigned, visited, ordered for and displayed on the map.
- Duplicate detection warns without silently merging distinct salons.
- Reassignment creates history and does not rewrite original acquisition or prior order attribution.

### M03 - Geographic data and mapping

**Engineer**
- Store canonical salon latitude/longitude in Kiran's database, with pair validation and source/accuracy/verification metadata where available.
- Build map layers from internal salon/prospect records, route stops and permitted representative location records.
- Use a provider adapter for map tiles, geocoding, navigation and nearby listing discovery. Google Maps/Places may be a provider, but is not the system of record.
- Keep manual pin creation available when provider search is unavailable or returns no results.
- Support Karachi area/territory boundaries and coverage filters.
- Track provider attribution, query limits and cost if nearby discovery is activated.
- A discovered Google listing is not a verified customer or a completed visit.

**Acceptance**
- Known salons without provider IDs render at stored coordinates.
- Reps can create a manual pin and later enrich its address/details.
- Map outages do not make existing customer/location records inaccessible.
- Map lookup never grants access to salon data outside the caller's scope.

### M04 - Field force, route, visit and representative location

**Engineer**
- Use the existing rep_day lifecycle as the workday boundary.
- Keep route planning separate from proof of visit. A route stop is intended work; a visit is an append-only event.
- A visit records salon, rep, rep day, server arrival time, client time for diagnostics, coordinates, accuracy, distance from salon pin, outcome, notes and anomaly/mock-location signals.
- Build check-in/check-out with existing stock/cash day-close gates. Orders/collections must not bypass applicable rep-day rules.
- Implement active-day location updates linked to the open rep_day; derive latest position and permitted history from append-only pings.
- Provide office map views for active reps, last update time, stale/offline state and approved historical trail.
- Clearly indicate when tracking is active. Stop collecting active-shift pings after check-out, suspension or revocation.
- Use explicit accuracy/staleness indicators. A missing GPS fix must be reported as missing, not fabricated.
- Do not rely on a browser tab alone for guaranteed continuous background tracking. Validate behaviour on supported Android devices and PWA lifecycle. A native wrapper or managed-device approach may be a separate decision if reliable background collection is required.
- Define ping cadence, background behaviour, retention, access and employee notice only after MJ resolves OQ-32.

**Acceptance**
- A visit has a server timestamp and captured GPS data or a clearly recorded unavailable/exception reason.
- Visit records cannot be edited/deleted by application users.
- Office sees only authorized active rep location and historical trail.
- Portal customers cannot view representative live location or tracking history.
- Check-out/offboarding stops future location capture.
- Tests cover inaccurate, stale, missing, mocked, out-of-geofence and replayed pings.

### M05 - Product catalogue and salon-specific price engine

**Engineer**
- Maintain canonical products, SKUs, variants, packs, units, barcodes, sellable status and product images.
- One shared catalogue identity is presented to all direct salons.
- Build the salon price resolver: for a salon and SKU, return the currently effective approved price under the approved pricing policy.
- Owner or manager writes SKU and salon-specific prices with a reason (D-37, D-39); dated price lists stay owner-only under D-08. OQ-33 is open on how a salon price below list meets the price gate.
- Preserve effective dates, audit history and actor/reason for every price change.
- Snapshot approved list price and effective unit price into each order line at order creation/acceptance according to the chosen order state rule.
- Never accept unit price, discount, subtotal, tax or total as authoritative merely because a browser submitted it.
- Keep agent pricing as a separate channel/data boundary; do not expose it to salons or salaried reps.

**Acceptance**
- Every salon sees the same active product/SKU set but only its own price result.
- Salon A cannot infer Salon B pricing through API responses, errors, exports or IDs.
- A price change affects future orders only; historical order/invoice snapshots do not change.
- A stale/manipulated client price is rejected or replaced by the server-calculated price.
- Only the owner or manager can change SKU and salon prices, and only the owner can change dated price lists.

### M06 - Inventory and customer-safe availability

The customer-facing part stays Phase 2 (INV-12, D-41); the ledger part is current.

**Engineer**
- Continue using append-only stock movements as the source of truth.
- Preserve warehouse, rep bag, quarantine, damaged and other internal locations as internal operational concepts.
- Derive current balances from movements; cached balances are rebuildable projections and must be reconciled.
- Define and test calculations for total on-hand, reserved/committed, unavailable and available-to-order.
- Build an authorized aggregate endpoint/view per active SKU. It returns only product identity, safe aggregate quantity and availability status/quantity.
- Do not expose individual locations, rep bag quantities, supplier receipt references, costs, lot details, investor attribution, write-off notes or custody movements to salon users.
- Prevent overselling through transactional reservation/commitment and order validation; prevent negative stock at the database boundary.
- All stock updates go through approved office actions and existing movement, two-party custody, maker-checker and audit controls. No editable quantity field may bypass the ledger.

**Acceptance**
- Salon, rep and office users receive the same approved aggregate stock definition, with office-only detail available through separate authorized functions.
- Tampering with an availability response cannot change the quantity accepted by the order function.
- Concurrent orders cannot promise more than sellable available stock.
- Returns, cancellations, delivery and reservation release update availability exactly once.
- Supplier identity, costs, margin and internal locations do not leak through customer-facing APIs/documents.

### M07 - Unified dual-channel order management

**Engineer**
- Use one canonical sales_order and sales_order_line model.
- Record at minimum: salon ID, channel/source, authenticated creator, created timestamp, idempotency key, order-taker rep (nullable), rep day (nullable), visit (nullable), status, price/credit snapshots and totals.
- Valid channels are explicit values: office and salon_portal, with rep_visit kept for legacy rows (D-30, D-34); do not infer channel from a user-supplied label. No new order_status values (D-34).
- A representative's order request derives the authenticated rep, verifies authorized salon access and an open rep day, and creates no official order.
- A salon's order request derives salon identity from an active authenticated membership and must not accept arbitrary salon, rep, rep-day or visit identity.
- The office's conversion of either request calls the same transactional domain function/service for SKU validity, quantity, price resolution, credit rules, availability, idempotency and order persistence.
- A retry returns the existing order result or a safe conflict; it must not duplicate the order.
- Store line-level price snapshots and server-calculated totals. Preserve existing discount and credit approvals.
- Support draft/held/confirmed states without bypassing the current order state machine. Confirmed orders must be distinguishable from customer submissions awaiting office decision.
- Do not silently rewrite order status, actor, attribution or price after submission. Use explicit transitions and audited corrections/cancellation.
- Rep offline work is order requests (ORD-14; ORD-10 is superseded); do not imply salon requests are safely offline unless separately designed and approved.

**Acceptance**
- One end-to-end rep request and one salon request wait in the same queue and, once converted, share downstream fulfilment/payment logic.
- The two orders are distinguishable by source, creator and order-taker attribution.
- Portal orders never create a fake visit, rep-day or rep sale.
- Order-intake cards cannot be attributed to another rep by client-supplied IDs.
- Invalid SKU, inactive product, bad quantity, stale price, insufficient stock, credit hold, suspended membership, duplicate idempotency key and cross-salon ID tampering are tested.

### M08 - Fulfilment, delivery, invoices, receipts and returns

**Engineer**
- Office order queue supports review, stock allocation, warehouse dispatch, rep-bag delivery, partial delivery, cancellation before delivery and exceptions under existing rules.
- Generate invoices from actual delivered lines using existing sequence/document-number logic. Do not invoice undelivered units unless an explicitly approved business rule requires it.
- Record receiver acknowledgement, server time and required GPS/photo/OTP evidence.
- Make invoices and receipts customer-readable and tied to the correct salon. Portal access is restricted to that salon's documents.
- Preserve immutable invoice snapshots. Corrections use existing credit-note/return workflow rather than editing a historical invoice.
- Keep complete status history with actor and reason.

**Acceptance**
- One order can be partially fulfilled without losing its unfulfilled balance.
- Stock movement and delivery/invoice creation occur transactionally and exactly once.
- Salon portal displays only documents for that salon.
- Cancel, return, credit-note and re-delivery scenarios reconcile inventory and receivables.

### M09 - Payments, credit and receivables

**Engineer**
- Reuse existing payments, installment plans, payment allocations, cash ledger, rep handover and bank reconciliation designs.
- Let salon users view their own payable statement, invoices, receipts, payments and due dates after those features exist and are authorized.
- Customer display must not expose internal credit scoring, exception notes, other salons' balances or rep cash/custody ledgers.
- Keep submitted order value, confirmed orders, delivered/invoiced value, payments received, banked collections and outstanding receivable as separate measures.
- Portal ordering must not bypass approved cash/credit blocks or overrides.
- Rep commission follows D-31 and D-38; OQ-09 stays open for fixed pay, bonus and deductions.

**Acceptance**
- Customer statement reconciles to invoices, allocations, credits and payments for that salon.
- A salon cannot mark a payment as received by editing a portal field. Payment confirmation follows the authorized payment workflow.
- Rep cash collections and salon direct payments are attributed to the actual actor/channel and payment method.

### M10 - Notifications and customer communication

**Engineer**
- Use existing provider-adapter strategy for SMS/WhatsApp/email; do not hard-code a provider into order logic.
- Provide order-submission acknowledgement, office decision, confirmation, dispatch/delivery, invoice/receipt availability and approved payment reminders.
- Record consent, template version, recipient, status and provider reference without treating provider delivery as business confirmation.
- Make messages idempotent and retryable. A failed notification must not duplicate an order, delivery or payment.
- WhatsApp reminders remain off by default until channel ownership, template approval and customer opt-in are confirmed.

**Acceptance**
- Customer receives a truthful acknowledgement for the actual order state.
- Notification failure does not roll back or duplicate a valid transaction.
- Opt-out prevents non-essential outbound reminders.

### M11 - Reporting and management analytics

**Engineer**
- Produce reports from canonical records with drill-through to source transactions.
- Separate: orders submitted by channel; orders awaiting decision, confirmed, partially fulfilled, delivered, invoiced, cancelled and returned; ordered/confirmed/delivered/invoiced/collected/banked/outstanding values; quantities ordered/fulfilled/returned/lost; physical rep visits, productive visits, outcomes and visit-to-card conversion; salon portal orders and repeat-order activity; salons acquired by rep, current assignment and rep requests converted into orders.
- Portal orders may count toward salon retention/reorder rates but not representative physical visits or rep request counts.
- Provide coverage views by Karachi area/territory, including unlocated salons, uncovered blocks, inactive customers, overdue visits and stale rep-location signals.
- Use explicit date/time-zone semantics (Karachi business day) and identify data freshness.
- Do not invent targets, conversion benchmarks, commission rates or ROI. Targets require owner-approved policy and source data.

**Acceptance**
- Every dashboard metric has a documented definition, grain, filters and source query/view.
- A sample order can be traced from submission through confirmation, delivery, invoice and payment.
- Reports do not combine ordered, delivered, invoiced, collected or banked amounts into one ambiguous "sales" number.

### M12 - Office administration, approvals and audit

**Engineer**
- Keep Owner and Manager in the existing office workspace and apply documented permission differences at API/RLS boundaries.
- Provide owner or manager invitations for reps and salons, and SKU and per-salon prices (D-39). Provide owner-governed role/permission administration, dated price-list management, system configuration and sensitive controls.
- Provide Manager operational workflows only within D-08 as amended by D-39.
- Stock, price, assignment, order-state, salon-membership and account changes must be auditable with actor, timestamp, reason and before/after data as allowed by the append-only audit model.
- Approval requests remain maker-checker; a maker cannot approve their own high-risk action. Use the existing single-use approval registry and replay protection.
- Provide exception queues for stale tracking, GPS anomalies, out-of-area visits, missing delivery acknowledgements, stock shortfalls, duplicate salons, price/stock conflicts, overdue orders and reconciliation mismatches.

**Acceptance**
- No new unrestricted admin role exists.
- UI hiding is not authorization; database/server reject unauthorized actions.
- Audit evidence is immutable and readable only by approved governance roles; owner and manager see scoped salon and order timelines (D-39).
- High-risk operations cannot be approved by the actor who initiated them.

## 5. Canonical end-to-end workflows

### 5.1 Salon is added to the customer database

1. An office user adds a salon (approved), or a rep proposes one (pending until the office approves or rejects it with a reason, D-35).
2. Enter business name, type, address, area/landmark, contact details and location.
3. Select an existing map result or drop a manual pin; external provider listing is optional.
4. Server normalizes/validates fields and checks likely duplicates.
5. Salon receives internal ID and source/acquisition attribution.
6. Authorized office user verifies details and assigns territory/current representative.
7. If portal access is approved, the owner or manager invites a verified contact, by invitation only, one salon per login (D-30, D-39, ACTIVITY L-0376). A salon invited with no rep has no rep (D-36).

### 5.2 Representative visits a salon and records the order details

1. Rep starts an approved workday and completes existing check-in gates.
2. App displays assigned route and salon pins.
3. Rep navigates to the salon and records arrival. Server records time and accepted GPS metadata.
4. Rep selects visit outcome and records notes.
5. For an order, the rep and the salon agree the requirements on the rep's screen and the rep saves a New Order Details card.
6. The card waits for the office; the rep does not create an order (D-30).
7. The manager opens the card in the Orders area and creates the official order; the server resolves price and validates stock and credit.
8. The card is closed and linked to the order; the card and visit are kept as provenance.
9. Office processes the order. Delivery, invoice, collection and status use the common workflow.

### 5.3 Salon submits an order request

1. Salon user authenticates to /salon.
2. Server resolves active salon membership; client cannot choose another salon ID.
3. Portal displays active catalogue and the salon's own prices (safe aggregate availability stays Phase 2, INV-12).
4. Salon builds a basket and submits with an idempotency key; no price is taken from the submitter.
5. Server records the request with the authenticated salon user as its submitter; rep, rep day and visit stay null unless a separately verified business event supplies a legitimate relation.
6. Salon receives acknowledgement of the true state. The request waits in the manager's Requests queue; nothing is reserved or delivered before confirmation (D-30, D-34). The salon may edit or cancel until then.
7. On conversion the server reloads current prices, product state and stock, rechecks credit and order constraints, and creates a salon_portal order linked to the card. A rejection closes the card with a reason.
8. Salon tracks the same order through shared status/document workflow.

### 5.4 Office fulfilment and closure

1. Office reviews the common order queue and distinguishes source channel.
2. Apply configured review/confirmation rule, validate credit/stock and allocate quantities.
3. Fulfil from an authorized warehouse or rep bag, capturing custody and delivery evidence.
4. Create invoice/receipt from fulfilled quantities.
5. Record payments and allocations through authorized money workflows.
6. Update customer-visible status and statements.
7. Preserve source attribution, original order snapshots and audit history.

### 5.5 Representative location oversight

1. Rep opens workday; app explains and indicates tracking state.
2. While workday is active, client submits location samples under approved cadence/platform capability.
3. Server verifies caller, device, open rep day, coordinate validity, timestamps, accuracy and replay controls.
4. Office sees current position, last-seen time, stale state and authorized trail.
5. On check-out, suspension or revocation, server stops accepting new active-day samples.
6. Location records are retained/accessed only under owner-approved policy.

## 6. Core domain data and relationships

This is a logical model. Reconcile it with actual migrations before implementation; do not create duplicate tables because a concept is named here.

| Domain concept | Required information / relationship |
|---|---|
| Salon | Canonical customer identity, contact, address, area, lat/lng, optional provider place ID, status/source |
| Salon portal membership | Auth user, salon ID, permitted customer actions, status, invited/verified/activated/revoked timestamps |
| Salon representative assignment | Salon, rep, effective-from/to, actor, reason; acquisition attribution stored separately |
| Rep day | Rep, Karachi business date, open/closed state, check-in/out and gates |
| Rep location ping | Rep, rep day, coordinates, accuracy, server time, client time, device and anomaly metadata |
| Visit | Salon, rep, rep day, server time, GPS metadata, outcome and append-only evidence |
| Product/SKU | Shared identity, variants, pack/unit, active/sellable status |
| Salon price | Salon, SKU, approved price, reason and audit history (`salon_sku_price`, D-37); dated price lists are separate (ORD-07) |
| Stock movement | SKU, quantity and internal from/to location, movement kind, source, actor and approval |
| Stock reservation/commitment | Order, SKU, quantity, status and release/consume event; transactional availability effect |
| Sales order | Salon, channel, creator, order-taker rep nullable, rep day/visit nullable, status, idempotency and snapshots |
| Sales order line | SKU, quantity, resolved unit price, list price and line-total snapshot |
| Delivery/invoice/receipt | Fulfilled order quantities, receiver acknowledgement, document number and customer ownership |
| Payment/allocation | Salon, actual payer/channel, method, value date, record actor and invoice allocation |
| Audit/approval | Actor, event, reason, state transition, immutable audit and one-time approval reference |

### Required invariants

1. External Maps listing is optional; internal salon ID and internal coordinates/area are authoritative.
2. A salon login is not the same as a salon contact. Membership must be explicit, authenticated and revocable.
3. Salon user identity is derived from server-side membership; never from an untrusted request field.
4. A salon's request or order does not require or create a rep visit.
5. A rep's request must have valid actor, permitted salon scope and an open rep day (a legacy rep-visit order kept its own context).
6. Original acquisition attribution never changes; current assignment is historical/effective-dated; every order retains actual source/creator/order-taker.
7. Both order channels use one canonical price, stock, credit and order-state engine.
8. Prices/totals are recalculated server-side and snapshots are immutable after the relevant order transition.
9. Stock balances and availability derive from ledger and reservation records. No direct balance writes.
10. Customer-facing stock is aggregate and sanitized; internal locations and supplier/cost data remain confidential.
11. Financial/stock corrections use reversing or adjustment entries and approval rules, not destructive edits.
12. Reports distinguish stages and measures; a submitted order is not automatically revenue, delivery, collection or banked cash.

## 7. Application architecture and trust boundaries

### 7.1 Baseline architecture

Preserve the repository's existing stack unless a documented technical review proves a change necessary:
- Next.js / React application with mobile-first rep PWA, salon portal and office workspace.
- Supabase Auth for identity and PostgreSQL for canonical transactions.
- Row-Level Security for row/tenant isolation.
- Server-side application functions/RPCs for privileged business actions.
- Private object storage and signed, scoped media access.
- Provider adapters for mapping/geocoding, SMS/WhatsApp, email and external services.
- Automated migrations, database tests, browser tests, type checks, lint, security scans and CI gates.

### 7.2 Mandatory trust boundaries

- Browser values are untrusted: salon ID, rep ID, price, stock, role, timestamp, status and totals must be validated or derived by the server.
- Salon portal calls use a dedicated customer authorization path. Do not reuse a rep RPC and merely pass a salon ID.
- Staff functions continue to authorize from existing staff role, territory and device policies.
- Service-role secrets never enter browser bundles and must not bypass policy design.
- Database RLS and server-side procedures enforce permissions; UI controls are usability only.
- Public aggregate inventory functions are allow-listed outputs. Do not grant salon users direct reads over raw stock tables or broad views.
- Map provider results are untrusted discovery data until reviewed and converted into canonical salon records.
- Notifications are secondary effects and do not define transaction success.
- Idempotency and database constraints protect against retries, concurrent requests and repeated taps.

### 7.3 Suggested interface boundaries

Suggested route families, to be adjusted after inspecting actual route tree:
- /app/* - representative workspace.
- /salon/* - salon customer portal.
- /office/* - owner/manager workspace.
- /api/* or server actions - authenticated adapters only; domain decisions live in server/database functions.

Route names are design guidance, not permission boundaries.

## 8. Engineering standards and non-functional requirements

- **Security:** preserve H-01 through H-27, RLS, session, device, approval, audit, vault isolation, service-role scanning and offboarding controls.
- **Availability:** field workflows tolerate intermittent mobile connectivity through existing outbox/sync strategy. Salon web ordering is online-first with clear no-acknowledgement behaviour.
- **Consistency:** order creation, stock reservation and price snapshot are transactional or use an explicitly designed equivalent with reconciliation.
- **Performance:** map pins and salon lists are paginated/clustered; use bounded server queries and indexes for area, territory, day, salon and order status.
- **Data quality:** normalize phone/address/name inputs; validate coordinate ranges; use timezone semantics and Karachi business-day rules.
- **Auditability:** visits, location samples, orders, order transitions, stock movement, price history, membership and payments have actor/time provenance.
- **Privacy:** collect location only under approved workday policy; disclose tracking to reps; restrict precise trails to authorized office users; define retention and applicable privacy requirements before launch.
- **Usability:** rep workflows are fast on small Android screens, support one-hand use and low bandwidth; salon checkout clearly shows price, quantity, availability and total.
- **Accessibility/localization:** responsive layouts, readable status labels, accessibility support and English-only copy (D-42).
- **Observability:** structured logs redact contact details, tokens, supplier/cost data and sensitive location payloads unless access is explicitly required and audited.

## 9. Delivery sequence and dependency order

This sequence does not automatically override the existing phase board or Phase 0/1 gates. Agents must reconcile each slice against docs 03, 11 and ACTIVITY before claiming work. For completion the order of work is the spec's section 6 (P1-18 to P1-24 on the board), which wins where it differs from this table.

| Sequence | Engineering slice | Dependencies | Exit condition |
|---|---|---|---|
| S0 | Source-of-truth audit and approved domain decisions | Existing repo, docs 00-14, ACTIVITY | Current tables/RPCs/screens/statuses mapped; contradictions/open questions recorded |
| S1 | Identity and salon membership design | S0, existing auth/RLS | Salon users separate from staff roles; cross-salon isolation proven |
| S2 | Salon CRM and reliable location records | Existing P1-02 foundation | Manual/map/provider registration, dedupe and assignment history work end-to-end |
| S3 | Shared catalogue, salon pricing and safe stock view | Existing SKU/inventory work | Customer-safe catalogue/price/availability endpoints pass role/RLS tests |
| S4 | Unified dual-channel order vertical slice | S1-S3, current ORD/credit/stock code | Rep and salon submit requests; the office converts them through one engine; attribution/idempotency/stock checks proven |
| S5 | Office order operations and customer status | S4, existing office UI | One queue, decision state, fulfilment handoff and customer status work |
| S6 | Representative map, visits and active-day tracking | S2, rep-day model, platform validation | Visits GPS-stamped; tracking boundaries and Android behaviour tested |
| S7 | Delivery, invoices, payments and customer documents | Existing P1-06/P1-07 code | Order-to-cash flow reconciles across both channels |
| S8 | Office dashboards and exception reporting | Canonical events from S2-S7 | Every metric is source-backed and channel-aware |
| S9 | Growth and optimization | Stable pilot evidence | Route optimization, automated reorder, discovery and demand forecasts measured against real usage |

**Implementation rule:** Deliver each slice as the smallest complete vertical slice: migrations/constraints, server function, RLS, UI, negative-path handling, tests, activity evidence and verification (by the builder or another agent, ACTIVITY §7, MJ L-0401). Do not create disconnected screens, mock success states, client-only enforcement or speculative tables without inspecting existing code.

## 10. Verification and acceptance matrix

The verifier (the builder itself is allowed, ACTIVITY §7, MJ L-0401) verifies evidence from the exact commit by running it, not by restating a summary.

| Test area | Minimum proof |
|---|---|
| Salon without Google Maps | Create with manual GPS/address; map, visit and order work with null provider place ID |
| Portal identity | Invite, activate, sign in, suspend, revoke and recover |
| Cross-salon isolation | Salon A cannot read/update/submit for/download Salon B data by changing IDs |
| Role separation | Salon user cannot call rep, office, owner, manager, agent or investor actions |
| Dual-channel ordering | A rep request and a salon request both become canonical sales orders only when the office converts them; a rep or salon cannot create one directly |
| Attribution | Creator/channel/order-taker/acquisition/current assignment remain distinct and correct |
| Price security | Manipulated price/discount/total rejected or replaced; historical snapshots unchanged |
| Stock security | No raw locations/costs/supplier leakage; concurrent order test prevents oversell |
| Inventory integrity | Delivery, reservation, cancellation, return and adjustment post exactly-once movements |
| Visit integrity | GPS, server timestamp, accuracy, distance and outcome recorded; visit is append-only |
| Live tracking | Only open-day active rep pings accepted; stale/missing/invalid/replayed signals handled |
| Portal request policy | Manager approval first (D-30, D-34) is explicit, auditable and covered by state-transition tests |
| Order-to-cash | Fulfilment, partial delivery, invoice, payment, allocation and statement reconcile |
| Reporting | Portal orders do not inflate physical visit/productive-visit/rep-request metrics |
| Notifications | Failure/retry does not duplicate orders, payments, deliveries or receipts |
| Governance | D-08 as amended by D-39: user/config/write-off powers, dated price lists and maker-checker controls remain enforced; a manager cannot create or promote an owner or manager |
| Operational safety | Service-role scan, audit log, backup/restore and CI checks pass |

Required test layers:
- Database/function tests for constraints, transactions, RLS and concurrency.
- Browser tests for representative, salon and office journeys using distinct test identities.
- Negative/attack tests for IDOR, cross-tenant reads, forged attribution, mass assignment, replay, stale price and stock race conditions.
- Device tests on supported Android/browser configurations for geolocation permissions, background suspension, battery and reconnect behaviour.
- Verification (by the builder or another agent, ACTIVITY §7) and current branch-protection checks before any merge; merging needs MJ's OK in chat for that pull request, no second reviewer (ACTIVITY section 10, MJ L-0401).
- No production data or production deployment as part of planning or ordinary implementation work.

## 11. Decisions that must remain open

The following choices affect implementation and must be resolved through docs 12 and ACTIVITY, not guessed by an agent:

- **OQ-31 - Salon order confirmation:** answered (D-30, D-34): the manager approves first. The salon may edit or cancel its request until approval, not after (ACTIVITY L-0378).
- **OQ-32 - Representative location policy:** ping cadence, permitted hours, background collection expectations, accuracy threshold, stale state, retention, notice and supported Android/device approach.
- **OQ-09 - Rep pay:** commission is decided (D-31, D-38); fixed pay, bonus and deductions stay open. Do not calculate them from example values.
- **OQ-16 - Real product catalogue:** actual products, variants, units, pack configuration and prices are required before replacing dummy product data.
- Existing payment, credit, delivery, communications and data import decisions remain governed by their existing open-question entries; investor decisions by D-40 and OQ-23, OQ-26, OQ-27, OQ-28.

If a decision blocks a complete safe slice, implement only the approved non-blocked portion and record the blocker. Do not convert an unapproved default into a permanent business rule.

## 12. Explicit non-goals

- Replacing the current stack or rewriting the application.
- Creating a generic unrestricted admin role.
- Making salon accounts equivalent to employee accounts.
- Making Google Maps listing status mandatory for salon registration.
- Creating separate order or stock systems for rep and salon channels.
- Exposing supplier identity, procurement terms, product cost, margin, rep cash/stock custody or other salons' records.
- Automatically assigning commission, salary deductions, investor return, ROI or profit-sharing formulas that MJ has not approved (D-38 approves the commission rule; D-40 forbids an investor engine).
- Treating planned routes, GPS pings, submitted orders, confirmed orders, deliveries, invoices, collections and banked funds as interchangeable evidence.
- Claiming a module is complete because a page exists or a test is self-reported.
- Bypassing Phase 0/1 status, approval gates, reviewer requirements or MJ's human-only decisions.

## 13. Definition of an implemented module

A module is not complete until all applicable items are true:

1. The business rule and domain owner are documented.
2. Existing tables, functions, UI and policies have been inspected; additions are compatible and additive.
3. Migration and rollback/recovery implications are understood.
4. Database constraints and server-side functions enforce the rule.
5. RLS and permission matrix tests prove allowed and denied paths.
6. UI supports the full successful and failure path for the intended actor.
7. Audit, idempotency, concurrency and reconciliation are addressed where relevant.
8. End-to-end browser/device tests prove the full journey.
9. A verifier (the builder or another agent, ACTIVITY §7, MJ L-0401) verifies exact-commit evidence.
10. ACTIVITY, status board and relevant plans are updated without claiming owner acceptance or phase completion.

**Product outcome:** One Karachi salon-distribution operation with two legitimate order channels, trusted field activity/location evidence, one shared catalogue and stock model, salon-specific prices, and one auditable order-to-cash process.
