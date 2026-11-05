# Project completion: final review checklist

**For:** the end-to-end journey of the completion design, section 7 (`docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md`), and the final review of slice 7 (P1-24). **Live status:** ACTIVITY section 12. **Written on:** branch `claude/p1-24-rep-readonly` (slice 7), whose base holds slices 1, 2, 3 and 6 but not slices 4 (delivery approval) and 5 (commission). Since then slices 4 and 5 merged to main (PR 59, PR 61); the remaining gate is slices 6 and 7 landing on top of them. This file says what the journey must do once slices 4, 5 and 6 are merged, so it can be added then; it is not built yet.

## 1. When to add it

Add the journey only when all of these are on one branch: slice 4 (`20261105130000`, `20261105130100`), slice 5 (`20261105140000`), slice 6 (`20261105150000`) and slice 7 (`20261105160000`), applied in that order. Merge order is MJ's. Before writing it:

- Slices 4 and 5 add database tests. Since slice 7 a rep's salon is pending, so each setup that creates a salon as a rep and then orders on it must approve it with `approveSalon` from `supabase/tests/helpers/db.ts` (the manager's `app.office_decide_salon`), or it fails with 55000 on the first order. On main (728514a), checked by grep: `supabase/tests/delivery-approval.test.ts` (three rep-made salons, rep A twice and rep B) needs it; `supabase/tests/commission.test.ts` creates its salons as the manager and needs nothing. The files slices 4 and 5 changed that this slice also changed (deliveries, handovers, invoice-document, office-cash, receivables-ageing, verifier-attacks) conflict textually on a merge; keep both sides.
- Slice 4 changes `apps/web/e2e-stack/office.spec.ts` and `scripts/e2e-stack-seed.mjs` (Rep One's bag, a warehouse, opening stock). Slice 7 changed the rep journey in the same spec (approval before the card, the office edits the salon, timelines). Resolve the merge by keeping both.
- Extend the timeline maps in `app.timeline_label`, `app.office_salon_timeline` and `app.office_order_timeline` (a later forward migration) to the slice 4 and 5 tables that name a salon or an order: `delivery_submission`, `delivery_submission_decision`, `pending_stock_resolution` (only if it names the order), `commission_payment` (not on a salon timeline unless it names the salon). Never add the stock, location, vault or investor tables, and never return row images. Add the test rows to `supabase/tests/rep-readonly-timelines.test.ts` and keep the leak test.

## 2. The journey, step by step

One Playwright test (or a serial group) in `apps/web/e2e-stack/office.spec.ts`, against the real local stack, as the existing journeys do. Mail limits: the local stack sends at most 2 emails an hour and the existing rep journey and slice 1 journey use both, so redeem the rep invitation with a code session on the database (`redeemAs`, as slice 1 does) and reuse the salon session kept by slice 1 (`salonPhone`, as slice 6 does). A second manager sign-in in one test waits for the next TOTP step (up to 30 seconds): give the test `JOURNEY_TIMEOUT_MS` or more.

| # | Who and where | Does | Visible result to assert (database values, not typed ones) |
|---|---|---|---|
| 1 | Manager, `/office/people` | Invites a rep and a salon (new salon in the seeded area) | "Invitation for ..." with a link shown once; both rows pending |
| 2 | Rep invitee (code session) and salon invitee (page and code) | Redeem | People shows the rep active and the salon account active; the salon page shows its name |
| 3 | Manager, `/office/products` and the salon page | Adds a `[Dummy]` product and SKU, sets a list price with a reason, sets the salon's own price | Product listed with its price; the salon's price on the salon page; picture skipped (no storage-api in the stack, as slice 2) |
| 4 | Salon, `/salon` | Adds the SKU to the basket and sends a request | The request listed as waiting, with the salon's own price; it survives a reload |
| 5 | Manager, `/office/orders` | Converts the request in one click | Order confirmed (or held for discount if the salon price is below list, OQ-33 default: then the owner approves the discount); channel salon portal; the request leaves the queue |
| 6 | Manager, `/office/orders` | Opens the order's Timeline | "request sent" by the salon login, "request converted" and "order created" by the manager |
| 7 | Rep, `/app/orders/[id]/deliver` (slice 4) | Submits the delivery from the bag | The submission waits; nothing is invoiced; the order still reads confirmed |
| 8 | Manager, `/office/deliveries` (slice 4) | Approves the delivery | Order delivered; an invoice number `INV-...`; stock moved from the bag |
| 9 | Rep, `/app/commission` (slice 5) | Opens commission | Earned equals floor(invoice total x rate / 10000), the rate being the salon's assignment rate else the rep's default |
| 10 | Manager, `/office/commission` (slice 5) | Records a commission payment | Paid and owed change; the payment in the history |
| 11 | Rep, `/app/commission` | Reloads | The payment and the owed figure the database computed |
| 12 | Salon, `/salon` | Reloads | Its order delivered; balance equals the invoice total minus payments; no other salon's data, no cost, no rep GPS |
| 13 | Manager, `/office/investors` | Records an investor, an investment, a profit decision and a payout | Owed figure after a reload (as the slice 3 journey) |
| 14 | Manager, the salon page | Reads the salon Timeline | invitation, salon account joined, request sent, order created, delivery recorded, invoice issued, in that order; no phone, pin, note text or reason |

Hand-work every amount in the test's comments (integer paisa, as the database tests do).

## 3. Seed fixtures

Exist on this branch (`scripts/e2e-stack-seed.mjs`): owner, manager, Rep One (approved phone), Rep Two (pending phone), a newcomer, a rep invitee; a `[Dummy]` SKU with a list price; a territory and area; a pending salon proposed by Rep One (inserted as postgres; since slice 7 the app can make one, but the seed may keep the insert); an approved catalogue salon.

Added by slice 4 (on its branch): Rep One's bag with its pending-delivery location, a warehouse, opening stock issued to the bag. Needed for step 7.

Needed and not yet seeded anywhere: a rep default commission rate for Rep One (slice 5's `app.office_set_commission_rate`), or set it in the journey on `/office/commission`; the salon's assignment rate if step 9 uses it (slice 1's approval with a rep and rate, or `app.office_assign_salon_rep`).

## 4. Final review of what this branch holds (slice 7 duty)

Findings are recorded in the TASK entry `docs/log/2026-11-05-claude-p1-24-rep-readonly.md`. Checked: duplicate entities, contradictory rules between docs and code, and the permission gaps the plan names (a manager promoting to owner or manager; reps creating or approving official orders; salons reading others' data; cost or supplier exposure). Re-run the same review after slices 4 and 5 merge.

## 5. Built in slice 8 (P1-25)

The journey is in `apps/web/e2e-stack/office.spec.ts` (CI only; not run on a host without Docker), as two tests after the check-out test and one before it: the delivery-approval boundary (a rep's submission writes no invoice and no sale movement; the rep's own identity is refused by `app.office_approve_delivery`; the manager's approval adds exactly one of each; a second decision is refused), and the end-to-end journey. Differences from the table above, each forced by the stack or chosen as the safer reading: steps 1 and 2 redeem both new invitations with a code session (`redeemAs`) because the stack's two e-mails an hour are spent, and the salon's browser steps use the slice 1 salon's kept session; steps 7 and 8 are the office delivering a rep-less salon order from the warehouse (A-18), because the rep's submission and approval are already covered by the slice 4 tests and the boundary test; step 9 asserts that no commission is earned on a rep-less order; the stock for the new product comes through the new Stock page (opening stock by an approved adjustment, then a stock issue Rep One confirms on `/app/stock`); the owner approves the slice 2 test's held discount on Approvals. Not extended: the timeline maps for the slice 4 and 5 tables (section 1, third bullet), still to do in a later forward migration.
