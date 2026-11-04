# Project completion: design

**Status:** not built. Live status stays on the ACTIVITY section 12 board.
**Authority:** `docs/16-project-completion-goal.md` (MJ's goal and master task, verbatim). Where any older document disagrees, that file wins. Reasoning and rulings: this spec. Decisions: `docs/log/2026-11-05-mj-reps-salons-orders.md`.
**Builds on:** `2026-11-03-orders-delivery-commission-design.md` (PR A merged; PR B plan written). Where they disagree, this spec wins.

## 1. Rulings on the source of truth

MJ's chat answers came first and the master task came later, so the master task wins where they differ. Each ruling is the safest reading; none invents a business rule.

| # | Question | Ruling | Why |
|---|---|---|---|
| R1 | MJ's chat said reps may create orders that wait; the master task says "Reps must not create, approve or modify official orders" and "A Rep submission is an order request" | A rep submits a request: `order_intake_card` with optional product lines. It is not a `sales_order` | Master task; keeps D-30's core |
| R2 | Chat allowed direct salon signup; master task says salons "Log in through an invitation" | Invitation only, as L-0376 already said. A salon invited with no rep has no rep | Master task |
| R3 | Chat wanted reps to add salons; master task makes salon information read-only and SAL-09 reconciled | A rep may propose a new salon, which stays pending. Reps cannot edit an existing salon. Salon notes stay | Proposing is not editing; both statements hold |
| R4 | "Access only their assigned Salons" against the built territory model | A salon with a direct assignment is reachable only by that rep. A salon with no direct assignment stays reachable by reps covering its territory. A salon with no area and no assignment has no rep | Direct-signup rule holds, and routes and visits keep working |
| R5 | Requested order statuses against the existing enum | No new enum values. The request has its own state (waiting, converted, rejected, cancelled); the official order keeps `order_status` | "Do not blindly add enum values" |
| R6 | "See their own approved prices" | New office-set price per salon and SKU; the portal shows it, otherwise list price | Master task |
| R7 | Commission "payment history" against D-31's earned-only | Earned stays derived from invoices. New append-only payment records with reversals. Owed is earned minus paid | Master task supersedes earned-only |
| R8 | Commission rate | Per rep and salon, with a rep default that pre-fills. Future invoices only | MJ's chat; not contradicted |
| R9 | "Project Completion Goal" named as an attachment | No separate document was received; the pasted master task and goal messages are the source | MJ: "THis is the attached" |

## 2. Who can do what

| Action | Salon | Rep | Manager | Owner |
|---|---|---|---|---|
| Join | Invitation | Invitation | Created by owner | Bootstrap |
| Invite, suspend, revoke reps and salons | — | — | Yes | Yes |
| Create or promote managers and owners | — | — | No | Yes |
| Propose a salon | — | Yes, pending | — | — |
| Approve a salon, assign a rep, set the rate | — | — | Yes | Yes |
| Edit a salon | — | No | Yes | Yes |
| Salon notes | — | Reachable salons | Yes | Yes |
| Products, pictures, descriptions, prices | Read own view | Read | Manage | Manage |
| Submit an order request | Own salon | Reachable salons | — | — |
| Edit or cancel a request before review | Own | Own | — | — |
| Convert, approve or reject a request | — | — | Yes | Yes |
| Create an official order directly | — | No | Yes | Yes |
| Submit a delivery; collect payment | — | As approved | — | — |
| Approve a delivery | — | — | Yes | Yes |
| Commission | — | Own, read | All | All |
| Investors | — | — | Yes | Yes |
| Timelines | — | — | Yes | Yes |

Salons are never a `user_profile.role`. Maker-checker stays: nobody approves their own discount or delivery.

## 3. Flows

**Invitation, no service role.** `scripts/service-role-scan.mjs` forbids a service-role key under `apps/`. Office creates an `invitation` and shares the link. The token is random, stored hashed, single use, expires in 7 days and is bound to the invited email. The invitee confirms that email with the one-time code, and the database redeems the token, creating the rep profile or the salon membership. Auth signup is on for the email code only, and the invite page is the only page that creates a login. A login with nothing redeemed has no profile, so RLS shows it nothing. Reps still need phone approval (SEC-03).

**Salon.** Office adds a salon (approved) or a rep proposes one (pending). Office approves with an optional rep and rate, or rejects with a reason. Pending salons cannot have requests or orders. Only office assigns or changes a rep.

**Request and order.** One queue, Requests, in the Orders area, holds rep and salon submissions. Both use `order_intake_card`, extended with a submitter kind, the salon and optional lines. Prices are never taken from the submitter. Rep note with no lines: one click opens the order form with salon and rep filled in. With lines: one click converts through `app.office_create_order`, linking the card (already built, PR A). Reject closes the card with a reason, using the existing close table. The submitter may edit or cancel while it waits; edits are new versions, not overwrites. No second ledger: official orders stay `sales_order` and `sales_order_line`, with channel `rep_visit` kept for legacy rows, `office` for direct orders and rep cards, `salon_portal` for salon cards.

**Delivery.** D-32 and the PR B plan with MJ's 13 answers. Nothing finalizes before approval.

**Commission.** `commission_rep_id` and `commission_rate_bp` stamped at delivery approval. Rate: the current assignment for that rep and salon, else the rep's default. Earned derived from invoices, floor(total x bp / 10000). Office records payments and reversals; rep and office see earned, paid, owed and history by date range.

**Timelines.** Office functions read `control.audit_event` for a salon or an order and show who did what and when. No second log.

**Investors.** Investors, investments, profit decisions typed by office, payouts, reversals with reasons. Totals derived. No formula or distribution engine. Office only, separate from commission, not posted to cash.

## 4. Data (extends existing tables)

All new tables: forced RLS, audit trigger, writes only through `security definer` `app.*` functions with pinned `search_path`, `client_id` idempotency, actor from the session, money in paisa. Append-only marked A.

- `invitation`; `salon_membership` (not a staff role; doc 06 section 2.1).
- `salon.approval_status` (existing rows backfilled to approved); `salon_approval_decision` (A); `salon_rep_assignment` (A).
- `order_intake_card` gains `submitter_kind`, nullable `rep_id` for salon cards; `order_intake_card_line` (A); versions for edits (A).
- `product.image_path`, `product.description`; bucket `product-images`, office writes, signed-in read, image types, 5 MB. `app.office_set_sku_price` for owner or manager, reason required. `salon_sku_price` (A).
- PR B tables as planned. `rep_commission_rate` (A); `commission_payment` (A, with reversals).
- `investor`, `investment` (A), `investor_profit_decision` (A), `investor_payout` (A).

Salons read only through `app.salon_*` functions resolving the salon from the active membership, returning allow-listed fields: never supplier, cost, margin, stock location, rep GPS or CRM notes. Reused: `app.build_order`, `office_create_order`, `evaluate_order`, `office_upsert_product`, `office_upsert_sku`, payments and receivables functions, `office_open_cards`.

## 5. Screens

- **Office:** People (invitations, reps, salons, rates); Salon approvals; Products; Orders gains Requests; Delivery approvals; Commission; Investors; timelines on salon and order pages.
- **Rep (`/app`):** commission, payment history, read-only account; salon pages read-only with notes and request form; propose a salon. Rep edit screen removed.
- **Salon (`/salon`, new):** invite and sign in, account, catalogue with pictures and own prices, requests, orders, payments and balance. Online only, no false success. Offline rep functionality keeps working.

## 6. Slices

One pull request each, built one at a time, each stacked on the last until merged.

| # | Slice |
|---|---|
| 0 | Source-of-truth doc, decisions and requirement docs reconciled |
| 1 | Invitations, membership, salon approval, assignment, reachability (R4), People and approvals screens |
| 2 | Products with pictures and descriptions, manager prices, per-salon prices |
| 3 | Investor ledger |
| 4 | Delivery submission and approval (existing plan) |
| 5 | Commission rates, stamps, payments, office and rep screens |
| 6 | Requests queue with lines, salon portal |
| 7 | Rep read-only (R3), proposals, timelines, end-to-end browser test |

## 7. Errors and tests

Errors: `42501` wrong role, `22023` bad input or unknown reference, `55000` wrong state, `23505` a replay whose facts differ. Every refusal shows the database's message.

Each slice proves, as real signed-in roles: anonymous, wrong-role and unredeemed-login refusals on every function; changing an id never widens access; salon A cannot read or act for salon B; a manager cannot create or promote an owner or manager; a revoked membership stops at once; a token cannot be reused, used late or used with another email; replays create nothing new; no partial writes; audit carries the session's actor; RLS matrix, allowlist and hygiene updated; one browser test per journey in CI. No test is weakened to pass.

End to end in CI: manager invites a rep and a salon; both join; manager adds a product with a picture and a salon price; salon sends a request; manager converts it; rep submits delivery; manager approves; rep sees commission earned; manager records a commission payment; rep sees it; salon sees its order and balance; manager records an investor decision and payout.

## 8. Not in this work

Investor logins or formulas, posting investor money to cash, stock shown to salons (INV-12), offline salon requests, salon sub-accounts, approvals digest (P1-08).

**Going live stays MJ's:** applying migrations to staging, the owner account with TOTP, turning on email signup and the storage bucket on the real project, real products, and adviser input on investor terms (OQ-23, OQ-26 to OQ-28).
