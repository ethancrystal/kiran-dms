# 03 — Requirements

Priorities use MoSCoW: **M** must have (MVP), **S** should have (Phase 2), **C** could have (Phase 3+), **W** won't have this year. Phase numbers refer to doc 11. Role abbreviations: **O** owner, **Mg** manager, **R** rep.

**Approved, not built:** rows citing D-33 to D-41 state rules MJ approved on 2026-11-05 (doc 16, doc 12). A row's phase says when it is due, never that it exists; task status is only on the ACTIVITY board.

## Functional requirements

### SAL — Salons (customer master / CRM)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| SAL-01 | Create a salon with: name, type (ladies' parlor / men's salon / unisex / bridal studio / barber / hair studio / spa or wellness centre offering hair services / home-based parlor / beauty academy or training institute / other), address, area, GPS pin, phone(s), owner/contact name, chairs (size), photo of frontage (stored once storage exists, ACTIVITY L-0146), notes, source (`map_pin` / `nearby_search` / `sweep` / `excel_import` / `referral` / `manual`). "Salon" means **any business anywhere in Karachi that offers hair care, hair treatment or hair beauty to end users**. External Maps listings/place IDs are optional; a salon can be created with a manually supplied address and pin/location data or added before its precise coordinates are available | M | 1 |
| SAL-02 | Each salon belongs to exactly one territory; territory derives from area or is set manually by Mg. A salon with no area and no direct assignment has no rep (D-36) | M | 1 |
| SAL-03 | Salon has a pipeline stage (see doc 02) maintained by the system; Mg/O can override with a mandatory reason | M | 1 |
| SAL-04 | Salon has a credit profile: plan eligibility (cash only / 2 / 4), credit limit (PKR), current exposure, overdue status | M | 1 |
| SAL-05 | Salon timeline: every visit, order, delivery, payment, message, note and stage change in one chronological view. The office also sees who did what and when for a salon or an order, read from `control.audit_event` through scoped functions, with no second log (D-39) | M | 1 |
| SAL-06 | Duplicate detection on create (phone number, name + area fuzzy match) | S | 2 |
| SAL-07 | Multiple contacts per salon (owner, manager, head stylist) with roles | S | 2 |
| SAL-08 | Salon tags (e.g., "uses competitor X", "bridal season peak") | C | 3 |
| SAL-09 | Rep sees only reachable salons (D-36: a direct assignment, else territory coverage), read-only; adds notes (MAP-03) and may propose a new salon (SAL-13); cannot edit an existing salon, delete or export. Reconciled with doc 16 by D-35, replacing "see and edit" | M | 1 |
| SAL-10 | Bulk import from Excel with field mapping and dry-run preview | M | 1 |
| SAL-11 | Secure salon customer portal membership: invite/verify customer user, link membership to the exact salon, support activation/suspension/revocation; contact records do not automatically become login identities. Phase moved by D-41 | M | 1 |
| SAL-12 | Salon portal reads only its own profile, shared active catalogue with pictures, its own approved prices (ORD-07; otherwise list price), own requests, orders/status/history and authorized invoices/receipts/statements, payments and balance. Phase moved by D-41; safe aggregate stock stays Phase 2 (INV-12) | M | 1 |
| SAL-13 | A rep proposes a new salon (works offline, like PIP-07); it stays pending, and a pending salon cannot have requests or orders. The office approves it, with an optional rep and rate, or rejects it with a reason, in an append-only decision. The office may also add a salon directly, approved (D-35) | M | 1 |
| SAL-14 | Assignment and reachability (D-36): a salon with a direct assignment is reachable only by that rep; with none, by reps covering its territory; with no area and no assignment, by no rep. Only the office assigns or changes a rep; the assignment history is append-only and never rewrites past attribution | M | 1 |

### PIP — Pipeline, territories, routes, visits

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| PIP-01 | Define territories as named sets of areas; assign one or more territories to a rep | M | 1 |
| PIP-02 | Log a visit: salon, rep, arrival time, GPS at arrival, outcome code, optional notes/photo (the photo is stored once storage exists, ACTIVITY L-0152). Visits are append-only | M | 1 |
| PIP-03 | Daily route for a rep: ordered list of stops with reason (reorder due, collection due, at-risk, prospect, delivery) | M | 1 (manual build) / S | 2 (auto-generated) |
| PIP-04 | Route days per territory (which salons fall on which weekday) | S | 2 |
| PIP-05 | Cycle estimation per salon × product group from order history; default cycles per product group configurable | M/S | 1 (thin: product-group default cycle + last purchase, D-19) / 2 (estimated from history) |
| PIP-06 | Due-for-reorder tasks generated at due − 3 days; at-risk transition at due + 50% cycle | M/S | 1 (thin due-list, D-19) / 2 |
| PIP-07 | Prospect quick-add from the field (≤ 60 seconds, works offline); it is a proposal, pending until the office approves it (SAL-13) | M | 1 |
| PIP-08 | Territory mapping sweep mode: fast sequential prospect capture with photo and pin; map-based capture and online discovery are specified in the MAP module below | S | 2 |
| PIP-09 | Rep daily check-in / check-out gating: no order requests or payments without check-in; unreconciled handover blocks next day with Mg override. Phase 1 so far (P1-02 part b): an earlier day left open blocks check-in until the office force-closes it with a reason; the handover condition joins with P1-07 | M | 1 |
| PIP-10 | Visit outcome taxonomy editable by O/Mg | S | 2 |
| PIP-11 | Geofence warning when "arrived" is tapped > 300 m from salon pin (logged, not blocking) | S | 2 |
| PIP-12 | Active-workday representative location samples linked to an open rep_day; validate caller/device/coordinates/accuracy/time, expose current/stale state only to authorized office roles, and stop accepting samples after close/revocation | M | 2 |
| PIP-13 | Office map shows permitted current representative positions and approved history; salon users never see rep GPS. Ping cadence, background mode and retention follow OQ-32 | M | 2 |

### MAP — Map prospecting and online discovery

The rep's map is the primary prospecting tool. It shows the rep's territory with every known salon as a pin, lets the rep drop and annotate new pins in the field, and — with one tap — pulls every online-listed salon, parlor, barber, hair studio or beauty business within a radius of the rep's **live GPS position** so nothing in the area is missed.

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| MAP-01 | Territory map view for the rep: all salons in assigned territories as pins, colour-coded by stage (prospect / trial / active / at-risk / dormant / blocked), with the rep's live position. Tapping a pin opens the salon card (stage, last order, balance due, next cycle) | M | 1 |
| MAP-02 | **Drop a pin**: long-press anywhere on the map to create a prospect at that location in ≤ 60 s — name (optional at first), type, photo, phone (optional), and a free-text **note ("chit")**. Works offline; geocoded to an area on sync. The new salon is a proposal, pending until the office approves it (SAL-13) | M | 1 |
| MAP-03 | **Pin notes**: every pin carries a running list of dated notes (who was met, what they use, when to come back). Notes are append-only and appear on the salon timeline (SAL-05) | M | 1 |
| MAP-04 | **Nearby discovery — one tap**: a "Find salons near me" button queries an online places provider for businesses offering hair care, hair treatment or hair beauty within a configurable radius (default 3 km ≈ 2 miles, max 6 km ≈ 4 miles) of the rep's **current GPS fix**. Results appear as grey "discovered" pins with name, address, rating, phone (if listed), and distance | S | 2 |
| MAP-05 | Discovery covers the full category set: ladies' beauty parlors, men's salons, unisex salons, barbers, hair studios, bridal studios, spas and wellness centres with hair services, home-based parlors listed online, beauty academies/training institutes — across all of Karachi, not just the rep's territory. Search terms and categories are configurable by O/Mg and include Urdu/Roman-Urdu variants ("parlour", "parlor", "salon", "saloon", "beauty", "hair", "mehndi/bridal") | S | 2 |
| MAP-06 | **Convert discovered → prospect** with one tap. Deduplication against existing salons by provider place id, phone, and name+distance (< 75 m) before creating; duplicates link to the existing record instead | S | 2 |
| MAP-07 | Discovered or dropped pins **outside the rep's territories** are saved and assigned to the territory they fall in (and that territory's rep); the discovering rep is recorded as `discovered_by` for the new-salon bonus (CTL-13). Manager notified | S | 2 |
| MAP-08 | **Pins → route**: the rep selects pins on the map (or "all due today" / "all prospects in this block") and the app orders them into an efficient walking/bike route from the rep's position; the route becomes today's route stops (PIP-03). The sequence is editable; the reason per stop is preserved | S | 2 |
| MAP-09 | **Pin timeline**: a per-rep chronological view of pins created, visited and converted — "what I covered this week" — and a territory heat view for O/Mg showing covered vs. uncovered blocks | S | 2 |
| MAP-10 | Discovery results are cached per area for 30 days to limit provider cost; a nightly job re-runs discovery for territories with reps and surfaces *new* listings as tasks ("3 new salons listed near your route") | C | 3 |
| MAP-11 | Discovery uses the rep's live GPS fix only — never a typed location — so a discovery call is also proof of presence; the fix, time and result count are logged on `rep_day` | S | 2 |
| MAP-12 | Map data (pins, phones) obeys the same RLS and masking rules as salon lists: reps see their territories' pins in full and other territories' pins as counts only; no export of pin sets | M | 1 |
| MAP-13 | O/Mg map: all territories, all reps' live positions during a `rep_day`, today's visits as a trail, uncovered zones | S | 2 |

### ORD — Orders, deliveries, invoices

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| ORD-01 | Create an official order for a salon, by the office only (owner or manager), directly or by converting an order request (ORD-15); reps and salons submit requests and do not create official orders (D-30, D-34): lines (SKU, qty, unit price: the salon's office-set price when one exists, otherwise the SKU's current list price, copied onto the line; OQ-33 settles how a salon price below list meets the price gate; price lists with dates are ORD-07), discounts below list only with approval (CTL-07), payment plan (cash / 2 / 4), delivery mode (from bag now / warehouse dispatch), and an optional assigned rep, the rep who delivers it: the manager (or owner) picks the delivering rep from the reps who can reach the salon (D-36; the card's rep pre-selected when converting a rep's card), and may choose none for a manager-direct or salon order (A-16, MJ L-0385) | M | 1 |
| ORD-02 | Credit check at order time for installment plans: plan allowed for salon, exposure + order ≤ credit limit, salon not Blocked. A cash-on-delivery order needs no credit, so a Blocked salon may still buy cash (doc 09 §2; MJ, ACTIVITY L-0163). Hard stop for an order made from a salon's request; Mg/O can override with reason | M | 1 |
| ORD-03 | Order states: draft → confirmed → delivered (full/partial) → closed; cancelled only before delivery, by Mg/O with a reason (a rep or salon may edit or cancel its own order request until the office decides it, not after (ACTIVITY L-0378, D-34)) | M | 1 |
| ORD-04 | A rep's delivery is an immutable submission that moves goods to the rep's pending location; only the owner's or manager's approval writes the delivery, the sale movement from pending, the invoice and installments and advances the order (D-32). A rep-less order is delivered by the office (A-18). Built in slice 4 (P1-21, migration 20261105130100), not verified | M | 1 |
| ORD-05 | Invoice/receipt PDF or image: Kiran branding, salon, lines, totals, payment plan schedule, receipt numbers. **Never** shows supplier or cost | M | 1 |
| ORD-06 | Returns: full/partial return of delivered goods with reason; stock movement back to location; credit note | S | 2 |
| ORD-07 | SKU list prices and a per-salon price per SKU, set by the owner or manager with a reason, append-only, future orders only (`app.office_set_sku_price`, `salon_sku_price`; D-37, D-39). Price lists with effective dates stay Phase 2 and owner-only under D-08 | M/S | 1 (SKU and per-salon prices, D-41) / 2 (dated price lists) |
| ORD-08 | Promotions / bundles (e.g., starter kit for new salons, buy-10-get-1) | C | 3 |
| ORD-09 | Order history and "frequently bought" suggestions per salon shown to the office when creating an order and to the salon when submitting a request | S | 2 |
| ORD-10 | Superseded by D-30: reps no longer create orders. The rep's offline work is visits, payments and order-intake cards (ORD-14, NFR-01) | — | — |
| ORD-14 | A rep or a salon submits an order request: an order-intake ("New Order Details") card with a submitter kind and optional product lines, never a price. It is not an official order. The submitter may edit (a new version) or cancel it while it waits (D-30, D-34) | M | 1 |
| ORD-15 | One Requests queue in the office Orders area holds rep and salon requests. With no lines, one click opens the order form with salon and rep filled in; with lines, one click converts through `app.office_create_order`. The card is closed and linked to the order. Rejecting closes it with a reason. Requested statuses keep their meaning without new `order_status` values; the request has its own state: waiting, converted, rejected, cancelled (D-34) | M | 1 |
| ORD-11 | One canonical order system (`sales_order`, `sales_order_line`), with explicit channels: `office` for direct orders and rep requests, `salon_portal` for salon requests, `rep_visit` for legacy rows only (D-30, D-34); stores the authenticated creator, the order-intake card it came from (nullable) and the delivering rep when one is assigned; preserves original acquisition rep and effective-dated current assignment separately. Phase moved by D-41 | M | 1 |
| ORD-12 | Authenticated salon user submits an order request (not an official order, D-34) only for the salon resolved from active server-side membership; idempotent submission; the office's conversion runs the same server-side catalogue, salon pricing, stock, credit and order-state checks as any office order. Phase moved by D-41 | M | 1 |
| ORD-13 | Salon user reads only its own requests and orders, current states, permitted history and customer documents; a salon's request waits for the manager's approval and nothing is reserved or delivered before confirmation (OQ-31 answered, D-30, D-34). Phase moved by D-41 | M | 1 |

### PAY — Payments, installments, cash, bank

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| PAY-01 | Installment plan templates: CASH (100% on delivery), INST2, INST4 — percentages and day offsets configurable by O/Mg; each delivered order generates its installment schedule | M | 1 |
| PAY-02 | Record a payment against one or more installments: method (cash / bank transfer), amount, date; bank transfer requires bank name and reference; optional photo of slip | M | 1 |
| PAY-03 | Receipt with sequential number issued per payment; sent to salon on WhatsApp (and/or SMS) | M | 1 (generate) / S | 2 (auto-send) |
| PAY-04 | Rep cash-in-hand ledger: increases on cash collected, decreases on handover; always visible to rep, Mg, O | M | 1 |
| PAY-05 | Daily handover: Mg records counted cash; system computes variance; variance requires a reason and is logged to the rep's record; cannot be edited after save, only reversed with a new entry | M | 1 |
| PAY-06 | Bank reconciliation: upload bank statement CSV; match transfers to recorded payments by amount/reference/date; flag unmatched | S | 2 |
| PAY-07 | Receivables ageing report (per salon, per rep, per territory) | M | 1 |
| PAY-08 | Overdue escalation ladder (doc 02 / doc 09): reminders, route flags, Mg tasks, auto-block | S | 2 (timers) — M | 1 (manual flags) |
| PAY-09 | Credit limit rules: starting limits by salon type; automatic increase after N on-time cycles; automatic decrease on late payments; Mg/O manual override | S | 2 |
| PAY-10 | Payments and handovers are append-only; corrections are reversing entries | M | 1 |
| PAY-11 | Partial payments and early settlement supported; schedule recalculates | M | 1 |

### INV — Inventory and restocking

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| INV-01 | SKU master: product line, product, variant (size, shade), unit, barcode (optional), selling price, active flag. Cost price lives in the vault (VLT), not here | M | 1 |
| INV-02 | Stock locations: warehouse(s) and one virtual location per rep ("bag/van stock") | M | 1 |
| INV-03 | Stock movements: receipt (from vault purchase), issue to rep, sale/delivery, return from salon, return to warehouse, damage/expiry write-off, adjustment (Mg/O, reason required). Movements are append-only | M | 1 |
| INV-04 | Live stock by location and SKU; rep sees own bag stock and warehouse availability (quantities only) | M | 1 |
| INV-05 | Daily stock close per rep (expected vs counted) with variance logging | M | 1 |
| INV-06 | Reorder point per SKU (manual in Phase 1; computed from demand × lead time + safety in Phase 2); low-stock alerts | M | 1 / S | 2 |
| INV-07 | Weekly restock suggestion: per SKU, suggested purchase qty with reasoning (sell-through, cover days, open orders) | S | 2 |
| INV-08 | Batch and expiry tracking per receipt; FEFO suggestion on issue; expiry alerts | S | 2 |
| INV-09 | Cycle counts and stock-take mode | S | 2 |
| INV-10 | Stock valuation report at cost (O/Mg only; cost from vault) | S | 2 |
| INV-11 | **Route-linked bag load** (D-19): for a rep's next route day, suggest the bag issue per SKU = expected demand of that day's stops (open orders to deliver from the bag, due reorders × last quantity, a small prospect allowance) − current bag stock, capped by warehouse availability and the bag value limit. Shortages are shown and recorded as demand (DEM-02). The manager issues the suggestion in one step through the two-party issue (CTL-05) | M | 1 |

| INV-12 | Authorized authenticated business users see safe aggregate on-hand and available-to-order quantities per active sellable SKU; salon/rep views never reveal internal locations, rep bag custody, supplier, cost, margin or restricted batch detail. Balances remain derived from append-only movements/reservations. Stays Phase 2: stock is not shown to salons in the current work (D-41) | M | 2 |
| INV-13 | Product pictures and descriptions on the catalogue: `product.image_path`, `product.description`; bucket `product-images`, office writes, signed-in read, image types only, 5 MB. Owner or manager adds and edits products (D-39, D-41) | M | 1 |

### VLT — Supplier vault (classified supplier)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| VLT-01 | Supplier records (identity, contacts, terms, documents) stored in a separate database schema with no direct API exposure; readable only via role-checked functions available to O/Mg | M | 1 |
| VLT-02 | Purchase orders and goods receipts (cost prices, quantities, dates) stored in the vault; goods receipt creates the public stock movement without cost or supplier reference | M | 1 |
| VLT-03 | Cost price and margin visible only to O/Mg, only on vault screens; never joined into any view, report or export a rep can reach | M | 1 |
| VLT-04 | Every vault read is audit-logged with user, time, record, and purpose | M | 1 |
| VLT-05 | Vault documents (supplier invoices, contracts) in a private storage bucket, signed URLs ≤ 5 minutes, O/Mg only | M | 1 |
| VLT-06 | Vault access is a revocable grant per user (default on for O/Mg), not an implied property of the role | M | 1 |
| VLT-07 | Sensitive fields encrypted at the column level with a key held outside the database (see doc 07) | S | 2 |

### SEC — Users, roles, security

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| SEC-01 | Roles: owner, manager, rep. Manager = full operational access; owner = operational + governance (users, bank details, write-offs/credit notes, price lists, commission plans, vault grants, audit log, configuration; commission rates: owner or manager, D-31, MJ L-0385; reps and salons (invite, suspend, revoke), products, pictures, descriptions and SKU and per-salon prices: owner or manager, D-39). A manager never creates or promotes an owner or manager. Permission matrix in doc 06 enforced by RLS and server-side checks | M | 1 |
| SEC-02 | O/Mg login: email + password + TOTP MFA mandatory | M | 1 |
| SEC-03 | Rep login: email one-time code (MJ decision, ACTIVITY L-0101; was phone OTP), after joining by invitation (SEC-16); device binding — first device auto-registered, new device requires Mg approval | M | 1 |
| SEC-04 | Sessions: rep 14 days with re-auth on sensitive actions; O/Mg 12 hours; immediate revoke by O/Mg | M | 1 |
| SEC-05 | Append-only audit log of all writes to money, stock, salon, user and vault tables, plus all vault reads | M | 1 |
| SEC-06 | No bulk export, copy-all, or list-download for reps; O/Mg exports watermarked with user + timestamp and logged | M | 1 |
| SEC-07 | Rate limits on list endpoints; page size caps for reps | M | 1 |
| SEC-08 | One-click offboarding: disable user, revoke sessions and devices, reassign territories, snapshot their bag stock and cash position | M | 1 |
| SEC-09 | Honeytoken salons (fake records visible only to one rep each) to detect list leakage | C | 3 |
| SEC-10 | Backups: PITR + weekly encrypted off-site export; restore drill quarterly | M | 1 |
| SEC-11 | Maker-checker: the user who initiates an approval-gated action can never approve it; approvals are recorded with approver, time and reason | M | 1 |
| SEC-12 | Audit log lives in a schema no application role can write to directly (populated by triggers), is hash-chained, and is mirrored nightly to write-only storage controlled by the owner | M | 1 |
| SEC-13 | Salon portal identity is a separate customer membership linked to specific salon IDs, never an internal staff role; accounts are created, suspended and revoked by the owner or manager and audited (D-30): invitation-only, one salon per login (ACTIVITY L-0376); one login per salon for now, no staff sub-accounts (ACTIVITY L-0382). Phase moved by D-41 | M | 1 |
| SEC-14 | Salon portal RLS/RPCs enforce own-salon-only access to profile, price, requests, orders and customer documents (aggregate stock too when INV-12 arrives); cross-salon ID tampering and revoked membership are denied by database tests. Phase moved by D-41 | M | 1 |
| SEC-15 | Salon/customer functions expose only allow-listed catalogue/price/customer-document data (aggregate stock too when INV-12 arrives); no supplier, cost, margin, internal inventory location, rep GPS or internal CRM notes. Phase moved by D-41 | M | 1 |
| SEC-16 | Invitations (D-39): the office creates an invitation for a rep or a salon and shares the link. The token is random, stored hashed, single use, expires in 7 days and is bound to the invited email. The invitee confirms that email with the one-time code and the database redeems the token, creating the rep profile or the salon membership. No service-role key in the app (H-18). The invite page is the only page that creates a login; a login with nothing redeemed has no profile and RLS shows it nothing. A rep still needs phone approval (SEC-03) | M | 1 |
| SEC-17 | The manager may invite, suspend and revoke reps and salons; only the owner creates or promotes an owner or manager, and agent accounts stay owner-created (AGT-01). The database refuses a manager who tries, as a role test (D-39) | M | 1 |

### CTL — Anti-fraud controls (detail and rationale in doc 13)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| CTL-01 | Every payment generates a system receipt delivered to the salon's registered phone (WhatsApp, SMS fallback) within 60 s of recording; paper receipts are not valid and invoices say so | M | 1 |
| CTL-02 | Payments must be recorded at the salon: GPS and server time captured; a payment recorded > 300 m from the salon pin or > 2 h after the visit's "arrived" tap is flagged for manager review | M | 1 |
| CTL-03 | Daily handover is two-party: manager enters counted cash, rep acknowledges the figure in their own app before it is final; disagreement locks the handover for owner review | M | 1 |
| CTL-04 | Cash in office is a tracked balance; every bank deposit is recorded with slip photo and matched to a bank statement line; cash in office older than 2 working days triggers an owner alert | M | 1 |
| CTL-05 | Stock issued to a rep is capped by a per-rep bag value limit; bag stock is counted daily (close) and spot-checked randomly by the manager at least weekly, with the count recorded in-app | M | 1 |
| CTL-06 | Stock adjustments and write-offs require a reason and photo; any adjustment, write-off, credit note or receivable write-off above a configurable threshold requires owner approval; all are in the daily digest | M | 1 |
| CTL-07 | Reps and salons have no discount authority: a request carries no price (D-34). Any price below list on an office order requires in-app approval by a manager or owner other than its maker before the invoice is issued, except the owner's own discount on an office order the owner creates, which needs no approval and is recorded on the order and in its audit row (MJ, ACTIVITY L-0390); dated price-list changes are owner-only; SKU and per-salon prices are owner or manager with a reason, and a manager's change is listed in the owner's digest (D-37, D-39, OQ-33) | M | 1 |
| CTL-08 | Credit limit overrides and salon unblocking by the manager are logged with reason, capped per salon per month, and listed in the daily digest | M | 1 |
| CTL-09 | New salon verification: a salon is "verified" only after an OTP sent to the salon's phone is confirmed and a manager has spoken to the salon; unverified salons are cash-only and earn no new-salon bonus. Interim (MJ, ACTIVITY L-0163): until verification is built, the owner sets plan eligibility and limit by hand | M | 1 |
| CTL-10 | Monthly statement to every salon with a balance, from the system, with a one-tap "this is wrong" reply that creates an owner-visible dispute | S | 2 |
| CTL-11 | Weekly random balance-confirmation sample: the system picks N salons per rep; owner or manager calls and records the salon's stated balance; mismatches open a case | M | 1 (manual list) / S | 2 (automated WhatsApp confirm) |
| CTL-12 | Returns go to a quarantine location, require photo and manager acceptance at the warehouse, and only then re-enter sellable stock | S | 2 |
| CTL-13 | Commission is calculated on delivered and invoiced value of orders assigned to the rep (D-31; brought into Phase 1 by ACTIVITY L-0385); clawback on write-offs; new-salon bonus only after the salon's second paid order. The rate is per rep and salon with a rep default, stamped at delivery approval; commission payments are recorded separately (D-38, FLD-06). Built in slice 5 (migration 20261105140000, not verified): `invoice.commission_rate_bp` is stamped in `app.finalise_delivery`, the salon assignment's rate for the order's assigned rep, else the rep's default, else 0; the clawback on write-offs waits for write-offs (P1-08) and the new-salon bonus is Phase 2 | M | 1 |
| CTL-14 | Anomaly detection jobs (doc 13 §7) run nightly and feed the owner digest: location/time anomalies, burst-recording, round-number patterns, repeated variances, rep-change churn, duplicate devices, mock-location signals | S | 2 |
| CTL-15 | Daily owner exception digest (in-app and WhatsApp): every override, adjustment, variance, discount, credit note, unblock, new device, failed sync, vault read, anomaly flag, agent purchase (with a flag on unusually large ones, D-22, OQ-22), invitation, manager price change, commission rate change, commission payment and investor payout (D-38 to D-40) from the last 24 h | M | 1 |
| CTL-16 | Company bank account details used on invoices are owner-only to change, require MFA re-authentication, and trigger a notification to all owner contacts | M | 1 |
| CTL-17 | Intraday cash cap: when a rep's cash in hand exceeds a configurable threshold (default Rs 50,000), the rep's new cash collections are refused until a handover (or bank deposit) is recorded, and the manager is notified (reps no longer place orders, D-30; MJ, ACTIVITY L-0377) | M | 1 |
| CTL-18 | Salon contact-phone changes require an OTP confirmed on the **new** number and send a notice to the **old** number ("reply NO if this wasn't you"); every change appears in the owner digest; the same phone on more than one salon is flagged | M | 1 |

### FLD — Field team management

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FLD-01 | Rep profile: name, phone, CNIC number (encrypted), photo, emergency contact, start date, territories, default commission rate (D-31, D-38) | M | 1 |
| FLD-02 | Rep scorecard (doc 02 KPIs) daily/weekly/monthly | S | 2 |
| FLD-03 | Commission plans: a rate per rep and salon with a rep default that pre-fills, set and changed by the owner or manager, for future invoices only, earned on delivered and invoiced value of assigned orders (D-31 as amended by D-38); the rep's own read-only view of earned, paid, owed and history for a date range is Phase 1; optional bonus for new salons and the monthly commission statement stay Phase 2. Built in slice 5 (not verified): the default rate in `rep_commission_rate` (`app.office_set_commission_rate`, with a reason), the salon rate on `salon_rep_assignment.rate_bp` (slice 1), `app.my_commission(from, to)` and `/app/commission` | M/S | 1–2 |
| FLD-04 | Rep onboarding checklist in-app (doc 08) | S | 2 |
| FLD-05 | Live map of today's visits per rep (O/Mg) | S | 2 |
| FLD-06 | Commission payment history: the office (owner or manager) records append-only commission payments and reversals with reasons; earned stays derived from invoices; owed is earned minus paid; separate from investor money (D-38, OQ-34). Built in slice 5 (not verified): `commission_payment`, `app.office_record_commission_payment` (refused above what is earned and unpaid, 23514), `app.office_reverse_commission_payment` (full, once, reason 5 to 500), `app.office_commission`, `app.office_commission_reps`, `/office/commission`; no checker (OQ-34 default) | M | 1 |

### RPT — Reporting and dashboards

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| RPT-01 | Owner dashboard (mobile-first): today's sales, today's collections, cash in reps' hands, overdue total, low-stock count, reps checked in | M | 1 |
| RPT-02 | Receivables ageing; sales by territory/product/salon type; stock by location | M | 1 |
| RPT-03 | Pipeline funnel and stage movement | S | 2 |
| RPT-04 | Margin reports (vault-gated) | S | 2 |
| RPT-05 | Accountant export pack: sales register, receipts register, receivables, stock valuation (CSV/XLSX) | S | 2 |

### MSG — Messaging

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| MSG-01 | Send receipt to salon on WhatsApp (template message) with SMS fallback | S | 2 |
| MSG-02 | Pre-due installment reminders and reorder nudges, opt-in per salon | S | 2 |
| MSG-03 | Internal notifications to Mg/O: variance, overdue thresholds, new-device requests, failed syncs | M | 1 (in-app) / S | 2 (push/WhatsApp) |
| MSG-04 | All outbound messages logged on the salon timeline | S | 2 |

### ADM — Administration and configuration

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| ADM-01 | Configure: installment templates, credit rules, product groups and default cycles, visit outcome codes, territories, commission plans (commission rates: owner or manager, D-31) | M/S | 1–2 |
| ADM-02 | Company profile for documents (name, logo, address, phone) | M | 1 |
| ADM-03 | Numbering sequences for invoices and receipts (gapless, per financial year starting 1 July) | M | 1 |

### AGT — Independent agents (D-15 to D-17)

An independent agent buys stock outright and resells it. Title passes at the sale, so agents carry no Kiran stock or cash and report nothing back (no visits, handover or bag counts). Salaried reps keep the custody model of doc 08.

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| AGT-01 | Agent role and onboarding: anyone may apply; the owner creates the account (governance, H-15) with minimum identity data (OQ-20); agents sign in like reps (email code, approved device) | M | 1 |
| AGT-02 | Agent price per SKU in its own table (`agent_price`, never readable by reps), set by the owner only; a SKU without an agent price is not sold to agents (OQ-17) | M | 1 |
| AGT-03 | Agent purchase (cash and carry): paid in full by cash at the counter or a matched transfer **before** stock leaves the warehouse; numbered invoice and receipt; stock movement `sale_to_agent`; never on credit (A-07) | M | 1 |
| AGT-04 | Agent app: own purchases, the catalogue with agent prices and warehouse availability (quantities only), and an **optional pre-order request**, the only thing an agent ever sends back (D-23). No salon data, no other agents, no cost or supplier (H-01, H-05) | S | 1 |
| AGT-05 | Agent reorder reminder from the agent's own purchase cycle | S | 2 |
| AGT-06 | **No recruitment pay**: Kiran pays no commission, bonus or override for enrolling other agents; agent earnings come only from their own resale margin (A-06; SECP, Companies Act 2017 s.301) | M | 1 |
| AGT-07 | Allocation when the supplier is short: configurable priority between direct salons' open orders and agent purchases (OQ-19) | S | 2 |

### DEM — Lost demand (D-18)

Stock-outs mostly start with supplier shortages, so demand that could not be served is recorded instead of disappearing.

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| DEM-01 | Quick capture during a visit: "asked for, could not sell": SKU (or, for an item Kiran does not carry, its product group; no free text, so no brand names land in `public`, H-27), quantity, reason (`not_in_bag` / `out_of_stock` / `not_in_catalogue` / `price` / `supply_short` (office only) / `other`), salon. Works offline; append-only; idempotent | M | 1 |
| DEM-02 | Automatic capture: when an order line, a delivery, an agent purchase or a bag-load suggestion is cut short by available stock (bag or warehouse), the shortfall is recorded with its reason and source, and whether it became a backorder or was lost | M | 1 |
| DEM-03 | Lost-demand report by SKU, reason, territory and week; unconstrained demand (delivered + lost) feeds reorder points and restock suggestions (doc 10 §6); supplier fill rate shown in the vault | M | 1 / S | 2 |

### CAP — Investor ledger (D-24, D-40)

A basic office ledger, separate from Rep commissions. It calculates nothing and distributes nothing. The wider capital and batch model in doc 14 is not approved by these rows.

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| CAP-01 | Owner or manager records investors and append-only investments, with money in paisa, office only; no investor login or portal | M | 1 |
| CAP-02 | Owner or manager types each profit decision (no formula) and records append-only payouts and reversals with reasons; totals are derived | M | 1 |
| CAP-03 | Investor money stays separate from commission and is not posted to the cash ledger; OQ-23, OQ-26, OQ-27 and OQ-28 stay open with MJ and MJ's advisers | M | 1 |

## Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Offline-first rep app.** Visits, rep order requests, payments, prospects can be captured with no connectivity and sync within 60 s of reconnecting; conflicts resolved server-side with the rep notified of any rejection |
| NFR-02 | **Performance on low-end Android.** First load ≤ 3 s on 3G after install; interactions ≤ 200 ms locally; bundle under 300 KB gzipped for the rep app shell |
| NFR-03 | **Bilingual UI.** English and Urdu (Nastaliq-safe font) with Roman Urdu accepted in free-text fields |
| NFR-04 | **Availability.** 99.5% monthly for the back office; rep app usable offline regardless |
| NFR-05 | **Data integrity.** Money and stock tables append-only; all balances derivable by replaying movements; nightly integrity job compares derived vs. stored balances |
| NFR-06 | **Auditability.** Any record can answer who/when/what-before/what-after |
| NFR-07 | **Security baseline.** OWASP ASVS Level 2 as the target; RLS on every table; no service-role key in any client; secrets in environment/secret manager only |
| NFR-08 | **Privacy.** Collect minimum personal data; CNIC encrypted; salon contact deletion on request with ledger retained in anonymised form |
| NFR-09 | **Cost.** ≤ USD 60/month infrastructure at launch scale (≤ 10 reps, ≤ 3,000 salons) |
| NFR-10 | **Recoverability.** RPO ≤ 24 h (PITR gives minutes), RTO ≤ 4 h |
| NFR-11 | **Observability.** Error tracking, sync failure dashboard, audit log search |
| NFR-12 | **Testability.** Automated tests for RLS policies (every role × every table), money arithmetic, and the stage machine |
